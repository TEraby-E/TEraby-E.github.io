#include <algorithm>
#include <iostream>
#include <random>
#include <vector>
using namespace std;

vector<int> makeValid(int n, mt19937 &rng) {
    vector<int> move(2 * n + 1, -1);
    fill(move.begin(), move.begin() + n, 1);
    shuffle(move.begin(), move.end(), rng);

    // 从前缀和第一次最小处之后循环读取，最后一步是多出来的出栈。
    int balance = 0, minimum = 0, begin = 0;
    for (int i = 0; i < static_cast<int>(move.size()); ++i) {
        balance += move[i];
        if (balance < minimum) {
            minimum = balance;
            begin = i + 1;
        }
    }
    vector<int> stack, order;
    stack.reserve(n);
    order.reserve(n);
    int next = 1;
    for (int k = 0; k < 2 * n; ++k) {
        if (move[(begin + k) % move.size()] == 1) {
            stack.push_back(next++);
        } else {
            order.push_back(stack.back());
            stack.pop_back();
        }
    }
    return order;
}

bool isValid(const vector<int> &order) {
    vector<int> stack;
    stack.reserve(order.size());
    int next = 1;
    for (int x : order) {
        while (next <= x) stack.push_back(next++);
        if (stack.empty() || stack.back() != x) return false;
        stack.pop_back();
    }
    return true;
}

vector<int> makeInvalid(int n, mt19937 &rng, int variant) {
    vector<int> order = makeValid(n, rng);
    if (n < 3) return order;  // n 小于 3 时没有非法的排列。
    if (variant % 3 == 0) {
        // 先排出一段合法序列，再把最后三项构造成压住 n-2 的反例。
        order = makeValid(n - 3, rng);
        order.insert(order.end(), {n, n - 2, n - 1});
        return order;
    }
    uniform_int_distribution<int> index(0, n - 1);
    for (int trial = 0; trial < 8; ++trial) {
        int i = index(rng), j = index(rng);
        swap(order[i], order[j]);
        if (!isValid(order)) return order;
        swap(order[i], order[j]);
    }
    shuffle(order.begin(), order.end(), rng);
    if (!isValid(order)) return order;
    // 固定非法模式 3,1,2，余下元素仍可随机排列。
    order.clear();
    for (int i = 4; i <= n; ++i) order.push_back(i);
    shuffle(order.begin(), order.end(), rng);
    order.insert(order.begin(), {3, 1, 2});
    return order;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int cases, n;
    if (!(cin >> cases >> n)) return 0;
    mt19937 rng(297);
    vector<int> valid(cases);
    fill(valid.begin(), valid.begin() + cases / 2, 1);
    shuffle(valid.begin(), valid.end(), rng);
    for (int i = 0; i < cases; ++i) {
        vector<int> order = valid[i] ? makeValid(n, rng) : makeInvalid(n, rng, i);
        cout << n;
        for (int x : order) cout << ' ' << x;
        cout << '\n';
    }
}

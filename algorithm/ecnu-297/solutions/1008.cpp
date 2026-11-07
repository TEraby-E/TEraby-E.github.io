#include <algorithm>
#include <functional>
#include <iostream>
#include <queue>
#include <utility>
#include <vector>
using namespace std;

struct Candidate {
    int sum, row, col;
    bool operator>(const Candidate &other) const {
        return sum > other.sum;
    }
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    vector<int> a(n), b(n);
    for (int &x : a) cin >> x;
    for (int &x : b) cin >> x;
    sort(b.begin(), b.end());

    // 对固定的 a[i]，与 b 相加所得的一整行是递增的。
    // 堆里只保留每行当前还没输出的第一个元素。
    vector<Candidate> first(n);
    for (int i = 0; i < n; ++i) first[i] = {a[i] + b[0], i, 0};
    priority_queue<Candidate, vector<Candidate>, greater<Candidate>> heap(greater<Candidate>{}, move(first));
    for (int i = 0; i < n; ++i) {
        Candidate smallest = heap.top();
        heap.pop();
        cout << smallest.sum << (i + 1 == n ? '\n' : ' ');
        if (smallest.col + 1 < n) {
            ++smallest.col;
            smallest.sum = a[smallest.row] + b[smallest.col];
            heap.push(smallest);
        }
    }
}

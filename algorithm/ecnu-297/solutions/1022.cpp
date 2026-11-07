#include <algorithm>
#include <iomanip>
#include <iostream>
#include <vector>
using namespace std;

struct Item {
    int weight;
    long long value;
};

void addOnce(vector<long long> &dp, int weight, long long value) {
    for (int cap = static_cast<int>(dp.size()) - 1; cap >= weight; --cap) {
        dp[cap] = max(dp[cap], dp[cap - weight] + value);
    }
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int once, bounded, unlimited, fractional, capacity;
    if (!(cin >> once >> bounded >> unlimited >> fractional >> capacity)) return 0;
    vector<long long> dp(capacity + 1);
    for (int i = 0; i < once; ++i) {
        int weight;
        long long value;
        cin >> weight >> value;
        addOnce(dp, weight, value);
    }
    for (int i = 0; i < bounded; ++i) {
        int weight, count;
        long long value;
        cin >> weight >> value >> count;
        // 把有限件拆成若干组 0/1 物品，仍然可以凑出 0 到 count 的件数。
        for (int group = 1; count > 0; group *= 2) {
            int take = min(group, count);
            if (1LL * take * weight <= capacity) addOnce(dp, take * weight, take * value);
            count -= take;
        }
    }
    for (int i = 0; i < unlimited; ++i) {
        int weight;
        long long value;
        cin >> weight >> value;
        for (int cap = weight; cap <= capacity; ++cap) {
            dp[cap] = max(dp[cap], dp[cap - weight] + value);
        }
    }

    vector<Item> items;
    for (int i = 0; i < fractional; ++i) {
        Item item;
        cin >> item.weight >> item.value;
        if (item.value > 0) items.push_back(item);
    }
    if (fractional == 0) {
        cout << dp[capacity] << '\n';
    } else {
        // 题面文字与样例有歧义：按样例，每类分数物品最多取一整件。
        sort(items.begin(), items.end(), [](const Item &a, const Item &b) {
            return a.value * b.weight > b.value * a.weight;
        });
        long double answer = 0;
        for (const Item &item : items) {
            if (item.weight <= capacity) {
                answer += item.value;
                capacity -= item.weight;
            } else {
                answer += static_cast<long double>(capacity) * item.value / item.weight;
                break;
            }
        }
        cout << fixed << setprecision(6) << answer << '\n';
    }
}

#include <iomanip>
#include <iostream>
#include <vector>
using namespace std;

const int base = 1000000000;
const int digits = 4;  // 最多 2^100 个子集，四段十进制九位足够。
struct Count {
    int part[digits] = {};

    void add(const Count &other) {
        long long carry = 0;
        for (int i = 0; i < digits; ++i) {
            long long value = static_cast<long long>(part[i]) + other.part[i] + carry;
            part[i] = static_cast<int>(value % base);
            carry = value / base;
        }
    }

    void print() const {
        int i = digits - 1;
        while (i > 0 && !part[i]) --i;
        cout << part[i];
        while (i > 0) cout << setw(9) << setfill('0') << part[--i];
        cout << '\n';
    }
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int cases;
    if (!(cin >> cases)) return 0;
    while (cases--) {
        int n, target;
        cin >> n >> target;
        vector<Count> ways(target + 1);
        ways[0].part[0] = 1;
        for (int i = 0; i < n; ++i) {
            int value;
            cin >> value;
            for (int sum = target; sum >= value; --sum)
                ways[sum].add(ways[sum - value]);
        }
        ways[target].print();
    }
    return 0;
}
